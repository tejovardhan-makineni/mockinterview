package auth

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/mail"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

type rejectMailTransport struct{ calls int }

func (r *rejectMailTransport) RoundTrip(*http.Request) (*http.Response, error) {
	r.calls++
	return nil, fmt.Errorf("unexpected provider request")
}
func TestMailRejectsInjectedRecipientsAndHeadersBeforeSending(t *testing.T) {
	for _, tc := range []struct{ name, from, to, subject string }{
		{"recipient CRLF", "sender@example.com", "candidate@example.com\r\nRCPT TO:<victim@example.com>", "Verify email"},
		{"recipient LF", "sender@example.com", "candidate@example.com\nBcc: victim@example.com", "Verify email"},
		{"recipient NUL", "sender@example.com", "candidate@example.com\x00", "Verify email"},
		{"encoded recipient controls", "sender@example.com", "=?utf-8?Q?Candidate=0D=0ABcc=3A_victim?= <candidate@example.com>", "Verify email"},
		{"recipient list", "sender@example.com", "candidate@example.com, victim@example.com", "Verify email"},
		{"missing domain", "sender@example.com", "candidate", "Verify email"},
		{"subject CRLF", "sender@example.com", "candidate@example.com", "Verify\r\nBcc: victim@example.com"},
		{"subject NUL", "sender@example.com", "candidate@example.com", "Verify\x00email"},
		{"sender CRLF", "sender@example.com\r\nBcc: victim@example.com", "candidate@example.com", "Verify email"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transport := &rejectMailTransport{}
			resend := ResendMailer{From: tc.from, Client: &http.Client{Transport: transport}}
			if err := resend.Send(context.Background(), tc.to, tc.subject, "Trusted verification body"); err == nil || !strings.HasPrefix(err.Error(), "invalid mail") {
				t.Fatalf("unsafe provider recipient was not rejected: %v", err)
			}
			if transport.calls != 0 {
				t.Fatal("unsafe input reached the mail provider")
			}
			smtp := SMTPMailer{From: tc.from, Address: "127.0.0.1:1", AllowLocalPlaintext: true}
			if err := smtp.Send(context.Background(), tc.to, tc.subject, "Trusted verification body"); err == nil || !strings.HasPrefix(err.Error(), "invalid mail") {
				t.Fatalf("unsafe SMTP input reached the transport: %v", err)
			}
		})
	}
}

// Observe the actual SMTP envelope and message, including DATA framing, rather
// than only checking a validation helper's return value.
func TestSMTPDeliversToOneParsedMailboxWithoutReflectingItIntoMessage(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	type capture struct {
		recipients []string
		message    string
		err        error
	}
	captured := make(chan capture, 1)
	go func() {
		conn, e := listener.Accept()
		if e != nil {
			captured <- capture{err: e}
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		writer := bufio.NewWriter(conn)
		reader := textproto.NewReader(bufio.NewReader(conn))
		reply := func(value string) { _, _ = fmt.Fprint(writer, value+"\r\n"); _ = writer.Flush() }
		reply("220 local test inbox")
		var result capture
		for {
			line, e := reader.ReadLine()
			if e != nil {
				result.err = e
				captured <- result
				return
			}
			switch {
			case strings.HasPrefix(line, "EHLO "), strings.HasPrefix(line, "HELO "), strings.HasPrefix(line, "MAIL FROM:"):
				reply("250 OK")
			case strings.HasPrefix(line, "RCPT TO:"):
				result.recipients = append(result.recipients, line)
				reply("250 OK")
			case line == "DATA":
				reply("354 Send message")
				data, e := reader.ReadDotBytes()
				if e != nil {
					result.err = e
					captured <- result
					return
				}
				result.message = string(data)
				reply("250 Accepted")
			case line == "QUIT":
				reply("221 Goodbye")
				captured <- result
				return
			default:
				result.err = fmt.Errorf("unexpected SMTP command %q", line)
				captured <- result
				return
			}
		}
	}()
	sender := SMTPMailer{Address: listener.Addr().String(), From: "Practice Team <sender@example.com>", AllowLocalPlaintext: true}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err = sender.Send(ctx, `Candidate Name <candidate@example.com>`, "Verify email", "Open the trusted verification link."); err != nil {
		t.Fatal(err)
	}
	result := <-captured
	if result.err != nil {
		t.Fatal(result.err)
	}
	if len(result.recipients) != 1 || result.recipients[0] != "RCPT TO:<candidate@example.com>" {
		t.Fatalf("expected exactly one canonical envelope recipient: %q", result.recipients)
	}
	message, err := mail.ReadMessage(strings.NewReader(result.message))
	if err != nil {
		t.Fatal(err)
	}
	to, err := message.Header.AddressList("To")
	if err != nil || len(to) != 0 || message.Header.Get("To") != "Mockinterview candidate:;" {
		t.Fatalf("unexpected To header: %+v %v", to, err)
	}
	if len(message.Header["To"]) != 1 || len(message.Header["Bcc"]) != 0 || message.Header.Get("Subject") != "Verify email" {
		t.Fatalf("message headers altered: %+v", message.Header)
	}
	if strings.Contains(result.message, "candidate@example.com") || strings.Contains(result.message, "Candidate Name") {
		t.Fatal("SMTP message reflected the untrusted recipient")
	}
	from, err := message.Header.AddressList("From")
	if err != nil || len(from) != 1 || from[0].Address != "sender@example.com" || from[0].Name != "Practice Team" {
		t.Fatalf("unexpected From header: %+v %v", from, err)
	}
	if message.Header.Get("MIME-Version") != "1.0" || message.Header.Get("Content-Type") != "text/plain; charset=UTF-8" {
		t.Fatalf("message MIME headers altered: %+v", message.Header)
	}
	body, err := io.ReadAll(message.Body)
	if err != nil || string(body) != "Open the trusted verification link.\n" {
		t.Fatalf("trusted message body altered: %q %v", body, err)
	}
}
