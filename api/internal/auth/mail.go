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
	data, _ := json.Marshal(map[string]any{"from": m.From, "to": []string{to}, "subject": subject, "text": body})
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
	from, err := mail.ParseAddress(m.From)
	if err != nil {
		return errors.New("invalid mail sender")
	}
	if strings.ContainsAny(subject+to, "\r\n") {
		return errors.New("invalid mail headers")
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
	if err = c.Rcpt(to); err != nil {
		return errors.New("mail recipient rejected")
	}
	w, err := c.Data()
	if err != nil {
		return errors.New("mail data rejected")
	}
	_, err = fmt.Fprintf(w, "From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s", m.From, to, subject, strings.ReplaceAll(body, "\n", "\r\n"))
	if err != nil {
		return err
	}
	if err = w.Close(); err != nil {
		return errors.New("mail send failed")
	}
	return c.Quit()
}
