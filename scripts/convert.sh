#!/usr/bin/env bash
# Convert PNG frame tar → MP4 with iPhone-compatible H.264 encoding
# Usage: ./scripts/convert.sh [-r <fps>] <input.tar>

set -euo pipefail

if ! command -v ffmpeg &>/dev/null; then
	echo "Error: ffmpeg is not installed" >&2
	exit 1
fi

# Parse options
fps=60
while getopts "r:" opt; do
	case "$opt" in
		r) fps="$OPTARG" ;;
		*) echo "Usage: $0 [-r <fps>] <input.tar>" >&2; exit 1 ;;
	esac
done
shift $((OPTIND - 1))

if [ $# -lt 1 ]; then
	echo "Usage: $0 [-r <fps>] <input.tar>" >&2
	exit 1
fi

input="$1"

if [ ! -f "$input" ]; then
	echo "Error: file not found: $input" >&2
	exit 1
fi

output="${input%.tar}.mp4"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "Extracting frames from $input..."
tar xf "$input" -C "$tmpdir"

echo "Stitching frames at ${fps}fps..."
ffmpeg -framerate "$fps" \
	-i "$tmpdir/%07d.png" \
	-c:v libx264 \
	-preset slow \
	-crf 18 \
	-pix_fmt yuv420p \
	-movflags +faststart \
	-an \
	"$output"

echo "Converted: $output"
