package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Hub fans run messages out to WebSocket clients subscribed to that run.
type Hub struct {
	mu   sync.Mutex
	subs map[int64]map[*wsClient]struct{}
	all  map[*wsClient]struct{}
}

type wsClient struct {
	send chan []byte
	conn *websocket.Conn
}

func NewHub() *Hub {
	return &Hub{subs: map[int64]map[*wsClient]struct{}{}, all: map[*wsClient]struct{}{}}
}

// Publish sends msg to the run's subscribers. A client that cannot keep up misses messages
// instead of slowing the run down; the UI refetches the timeseries after a gap.
func (h *Hub) Publish(runID int64, msg any) {
	b, err := json.Marshal(msg)
	if err != nil {
		slog.Error("ws marshal", "err", err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.subs[runID] {
		select {
		case c.send <- b:
		default:
		}
	}
}

// CloseAll disconnects every client (server shutdown).
func (h *Hub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.all {
		c.conn.Close(websocket.StatusGoingAway, "server shutting down")
	}
}

func (h *Hub) serve(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil) // rejects cross-origin pages by default
	if err != nil {
		return
	}
	c := &wsClient{send: make(chan []byte, 64), conn: conn}
	h.mu.Lock()
	h.all[c] = struct{}{}
	h.mu.Unlock()
	ctx, cancel := context.WithCancel(r.Context())
	defer func() {
		cancel()
		h.mu.Lock()
		delete(h.all, c)
		for _, set := range h.subs {
			delete(set, c)
		}
		h.mu.Unlock()
		conn.CloseNow()
	}()

	go func() { // reader: subscribe / unsubscribe
		defer cancel()
		for {
			var m struct {
				Type  string `json:"type"`
				RunID int64  `json:"runId"`
			}
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			if json.Unmarshal(data, &m) != nil || m.RunID <= 0 {
				continue
			}
			h.mu.Lock()
			switch m.Type {
			case "subscribe":
				if h.subs[m.RunID] == nil {
					h.subs[m.RunID] = map[*wsClient]struct{}{}
				}
				h.subs[m.RunID][c] = struct{}{}
			case "unsubscribe":
				delete(h.subs[m.RunID], c)
			}
			h.mu.Unlock()
		}
	}()

	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case b := <-c.send:
			wctx, wcancel := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Write(wctx, websocket.MessageText, b)
			wcancel()
			if err != nil {
				return
			}
		case <-ping.C:
			if err := conn.Ping(ctx); err != nil {
				return
			}
		}
	}
}
