// Package secret encrypts values at rest (environment secrets) with AES-256-GCM.
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// prefix marks ciphertext so plaintext and encrypted values can never be confused.
const prefix = "enc:v1:"

type Box struct{ aead cipher.AEAD }

// LoadKey decodes envKey (base64 of 32 bytes) or, when empty, reads dataDir/secret.key,
// generating it with mode 0600 on first start.
func LoadKey(envKey, dataDir string) ([]byte, error) {
	if envKey != "" {
		return decodeKey(envKey, "NDSWARM_SECRET_KEY")
	}
	path := filepath.Join(dataDir, "secret.key")
	b, err := os.ReadFile(path)
	if err == nil {
		return decodeKey(strings.TrimSpace(string(b)), path)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key := make([]byte, 32)
	rand.Read(key)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if _, err := f.WriteString(base64.StdEncoding.EncodeToString(key) + "\n"); err != nil {
		return nil, err
	}
	return key, f.Sync()
}

func decodeKey(s, source string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("%s must be base64 of 32 bytes (openssl rand -base64 32)", source)
	}
	return key, nil
}

func New(key []byte) (*Box, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead}, nil
}

func (b *Box) Seal(plaintext string) string {
	nonce := make([]byte, b.aead.NonceSize())
	rand.Read(nonce)
	return prefix + base64.StdEncoding.EncodeToString(b.aead.Seal(nonce, nonce, []byte(plaintext), nil))
}

func (b *Box) Open(ciphertext string) (string, error) {
	raw, ok := strings.CutPrefix(ciphertext, prefix)
	if !ok {
		return "", errors.New("secret: not an encrypted value")
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(data) < b.aead.NonceSize() {
		return "", errors.New("secret: malformed value")
	}
	n := b.aead.NonceSize()
	plain, err := b.aead.Open(nil, data[:n], data[n:], nil)
	if err != nil {
		return "", errors.New("secret: cannot decrypt (wrong NDSWARM_SECRET_KEY?)")
	}
	return string(plain), nil
}
