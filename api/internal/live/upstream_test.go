package live

import (
	"google.golang.org/genai"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type concurrentSender struct {
	active  atomic.Int32
	overlap atomic.Bool
}

func (s *concurrentSender) send() error {
	if s.active.Add(1) != 1 {
		s.overlap.Store(true)
	}
	time.Sleep(time.Microsecond)
	s.active.Add(-1)
	return nil
}
func (s *concurrentSender) SendClientContent(genai.LiveClientContentInput) error { return s.send() }
func (s *concurrentSender) SendRealtimeInput(genai.LiveRealtimeInput) error      { return s.send() }
func (s *concurrentSender) SendToolResponse(genai.LiveToolResponseInput) error   { return s.send() }
func TestUpstreamAudioTransitionsAndToolsSerialize(t *testing.T) {
	sender := &concurrentSender{}
	u := &upstream{session: sender}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(3)
		go func() { defer wg.Done(); _ = u.audio(genai.LiveRealtimeInput{}) }()
		go func() { defer wg.Done(); _ = u.content(genai.LiveClientContentInput{}) }()
		go func() { defer wg.Done(); _ = u.tool(genai.LiveToolResponseInput{}) }()
	}
	wg.Wait()
	if sender.overlap.Load() {
		t.Fatal("concurrent SDK writes")
	}
}
