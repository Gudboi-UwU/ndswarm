#!/bin/sh
# Packs an offline bundle: the image as a file, a compose file without build steps, and a short guide.
# Usage: deploy/bundle.sh <version> <image already loaded locally> <out dir>
set -eu
version=$1 image=$2 out=$3
name="ndswarm-$version"
dir="$out/$name"
mkdir -p "$dir"
docker tag "$image" "ndswarm:$version"
docker save "ndswarm:$version" | gzip -9 > "$dir/$name.tar.gz"
# Same compose as the repo, minus the build section, pinned to this version.
sed -e '/^    build:/,/^      dockerfile:/d' \
    -e "s|\${NDSWARM_IMAGE:-ndswarm:dev}|ndswarm:$version|" \
    -e "s|# Quick start: docker compose -f deploy/docker-compose.yml up|# Quick start: docker load -i $name.tar.gz \&\& docker compose up -d|" \
    deploy/docker-compose.yml > "$dir/docker-compose.yml"
cat > "$dir/CARA-PAKAI.txt" <<GUIDE
ndswarm $version

1. Muat image (sekali saja):
     docker load -i $name.tar.gz

2. Jalankan (dari folder ini):
     docker compose up -d

3. Buka http://localhost:8089, buat akun admin, lalu buka Projects > Demo shop > "Browse and checkout"
   (test demo terhadap server dummy bawaan) dan tekan "Run test".

Berhenti:        docker compose down
Hapus data juga: docker compose down -v

Tanpa demo / tanpa compose:
     docker run -d -p 8089:8089 -v ndswarm-data:/data --ulimit nofile=65536:65536 ndswarm:$version

Menguji API di komputer yang sama:
  Di dalam Docker, "localhost" berarti container ndswarm sendiri.
  Pakai http://host.docker.internal:<port> untuk API yang jalan di komputer ini
  (API-nya harus listen di 0.0.0.0, bukan hanya 127.0.0.1).
API di internet atau jaringan kantor bisa langsung dipakai alamatnya.
GUIDE
docker compose -f "$dir/docker-compose.yml" config -q
tar -C "$out" -czf "$out/$name-bundle.tar.gz" "$name"
echo "$out/$name-bundle.tar.gz"
