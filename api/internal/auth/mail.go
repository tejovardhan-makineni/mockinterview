package auth

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

// ResendMailer uses a fixed provider origin; credentials never enter user data.
type ResendMailer struct {
	APIKey, From string
	Client       *http.Client
}

func (m ResendMailer) Send(ctx context.Context, to, subject, body string) error {
	sender, recipient, err := mailAddresses(m.From, to, subject)
	if err != nil {
		return err
	}
	data, _ := json.Marshal(map[string]any{"from": sender.String(), "to": []string{recipient.Address}, "subject": subject, "text": body})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+m.APIKey)
	req.Header.Set("Content-Type", "application/json")
	client := m.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("mail transport failed")
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("mail delivery rejected (%d)", resp.StatusCode)
	}
	return nil
}

// SMTPMailer requires STARTTLS on remote hosts. Plain SMTP is restricted to a
// loopback development inbox. All network operations have a bounded deadline.
type SMTPMailer struct {
	Address, Username, Password, From string
	AllowLocalPlaintext               bool
}

func (m SMTPMailer) Send(ctx context.Context, to, subject, body string) error {
	from, recipient, err := mailAddresses(m.From, to, subject)
	if err != nil {
		return err
	}
	host, _, err := net.SplitHostPort(m.Address)
	if err != nil {
		return err
	}
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", m.Address)
	if err != nil {
		return errors.New("mail connection failed")
	}
	defer conn.Close()
	deadline := time.Now().Add(15 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetDeadline(deadline)
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		return errors.New("mail greeting failed")
	}
	defer c.Close()
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err = c.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
			return errors.New("mail TLS failed")
		}
	} else {
		ip := net.ParseIP(host)
		local := host == "localhost" || (ip != nil && ip.IsLoopback())
		if !m.AllowLocalPlaintext || !local {
			return errors.New("mail server requires STARTTLS")
		}
	}
	if m.Username != "" {
		if err = c.Auth(smtp.PlainAuth("", m.Username, m.Password, host)); err != nil {
			return errors.New("mail authentication failed")
		}
	}
	if err = c.Mail(from.Address); err != nil {
		return errors.New("mail sender rejected")
	}
	if err = c.Rcpt(recipient.Address); err != nil {
		return errors.New("mail recipient rejected")
	}
	w, err := c.Data()
	if err != nil {
		return errors.New("mail data rejected")
	}
	// Account messages use a fixed empty group (RFC 5322 section 3.4) in the
	// visible To header. Delivery still targets the single validated SMTP
	// envelope recipient above; user-provided names and addresses never become
	// message content. SMTP clients display this group instead of the address.
	_, err = fmt.Fprintf(w, "From: %s\r\nTo: Mockinterview candidate:;\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s", from.String(), subject, strings.ReplaceAll(body, "\n", "\r\n"))
	if err != nil {
		return err
	}
	if err = w.Close(); err != nil {
		return errors.New("mail send failed")
	}
	return c.Quit()
}

// Parse once and use only the canonical mailbox values at email boundaries.
// Reject line and NUL controls before parsing; ParseAddress must accept exactly
// one mailbox, so raw caller strings can never become extra SMTP commands or
// message headers. Sender names are MIME-escaped by Address.String.
func mailAddresses(from, to, subject string) (*mail.Address, *mail.Address, error) {
	if strings.ContainsAny(from, "\r\n\x00") || strings.ContainsAny(to, "\r\n\x00") || strings.ContainsAny(subject, "\r\n\x00") {
		return nil, nil, errors.New("invalid mail headers")
	}
	sender, err := mail.ParseAddress(from)
	if err != nil || sender.Address == "" || len(sender.Address) > 254 || strings.ContainsAny(sender.Name+sender.Address, "\r\n\x00") {
		return nil, nil, errors.New("invalid mail sender")
	}
	recipient, err := mail.ParseAddress(to)
	if err != nil || recipient.Address == "" || len(recipient.Address) > 254 || strings.ContainsAny(recipient.Name+recipient.Address, "\r\n\x00") {
		return nil, nil, errors.New("invalid mail recipient")
	}
	return sender, recipient, nil
}
