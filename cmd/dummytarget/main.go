// Command dummytarget serves predictable endpoints to load test against. See internal/dummy.
package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/Gudboi-UwU/ndswarm/internal/dummy"
)

func main() {
	addr := flag.String("addr", ":8090", "listen address")
	flag.Parse()
	log.Printf("dummytarget listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, dummy.Handler()))
}
