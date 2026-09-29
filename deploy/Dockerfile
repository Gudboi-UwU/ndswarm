# syntax=docker/dockerfile:1
# Build: docker build -f deploy/Dockerfile -t ndswarm:dev .
# Multi-arch: docker buildx build --platform linux/amd64,linux/arm64 -f deploy/Dockerfile .
# The web and Go stages run on the build machine; Go cross-compiles, so no emulation is needed.

FROM --platform=$BUILDPLATFORM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS go
ARG VERSION=dev
ARG TARGETOS=linux
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY web/embed.go web/
COPY --from=web /src/web/dist web/dist
RUN export CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
 && go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/ndswarm ./cmd/ndswarm \
 && go build -trimpath -ldflags "-s -w" -o /out/dummytarget ./cmd/dummytarget \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go /out/ndswarm /out/dummytarget /
COPY --from=go --chown=65532:65532 /out/data /data
USER 65532
ENV NDSWARM_DATA_DIR=/data
VOLUME /data
EXPOSE 8089
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD ["/ndswarm", "healthcheck"]
ENTRYPOINT ["/ndswarm"]
