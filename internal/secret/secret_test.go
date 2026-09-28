package secret

import (
	"os"
	"path/filepath"
	"testing"
)

func TestKeyAndRoundTrip(t *testing.T) {
	dir := t.TempDir()
	k1, err := LoadKey("", dir)
	if err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(filepath.Join(dir, "secret.key")); st.Mode().Perm() != 0o600 {
		t.Errorf("key file mode %v", st.Mode().Perm())
	}
	k2, _ := LoadKey("", dir)
	if string(k1) != string(k2) {
		t.Error("key not stable across loads")
	}
	if _, err := LoadKey("short", dir); err == nil {
		t.Error("accepted bad env key")
	}

	box, _ := New(k1)
	c1, c2 := box.Seal("hunter2"), box.Seal("hunter2")
	if c1 == c2 {
		t.Error("nonce reused")
	}
	if p, err := box.Open(c1); err != nil || p != "hunter2" {
		t.Errorf("Open: %q %v", p, err)
	}
	other, _ := New(make([]byte, 32))
	if _, err := other.Open(c1); err == nil {
		t.Error("decrypted with wrong key")
	}
	if _, err := box.Open("hunter2"); err == nil {
		t.Error("accepted plaintext")
	}
}
