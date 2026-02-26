#!/usr/bin/env bash
# Convert PNG frames → MP4 with iPhone-compatible H.264 encoding
# Usage: ./scripts/convert.sh [-r <fps>] [-o <outdir>] <input.tar | input_dir>

set -euo pipefail

if ! command -v ffmpeg &>/dev/null; then
	echo "Error: ffmpeg is not installed" >&2
	exit 1
fi

# Parse options
fps=""
outdir=""
while getopts "r:o:" opt; do
	case "$opt" in
		r) fps="$OPTARG" ;;
		o) outdir="$OPTARG" ;;
		*) echo "Usage: $0 [-r <fps>] [-o <outdir>] <input.tar | input_dir>" >&2; exit 1 ;;
	esac
done
shift $((OPTIND - 1))

if [ $# -lt 1 ]; then
	echo "Usage: $0 [-r <fps>] [-o <outdir>] <input.tar | input_dir>" >&2
	exit 1
fi

input="$1"

if [ -d "$input" ]; then
	# --- Directory of PNGs (streamed capture) ---
	framedir="$input"

	# Read fps from meta.json if not overridden by -r flag
	if [ -z "$fps" ]; then
		meta="$framedir/meta.json"
		if [ -f "$meta" ] && command -v python3 &>/dev/null; then
			fps=$(python3 -c "import json; print(json.load(open('$meta'))['fps'])" 2>/dev/null || echo "60")
		else
			fps=60
		fi
	fi

	dirname="$(basename "$input")"
	if [ -n "$outdir" ]; then
		output="$outdir/${dirname}.mp4"
	else
		output="${input%/}.mp4"
	fi

	echo "Stitching frames from $framedir at ${fps}fps..."
	ffmpeg -framerate "$fps" \
		-i "$framedir/%07d.png" \
		-c:v libx264 \
		-preset slow \
		-crf 18 \
		-pix_fmt yuv420p \
		-movflags +faststart \
		-an \
		"$output"

	echo "Converted: $output"
else
	# --- Tar archive (legacy capture) ---
	if [ ! -f "$input" ]; then
		echo "Error: file not found: $input" >&2
		exit 1
	fi

	: "${fps:=60}"

	basename="${input%.tar}"
	if [ -n "$outdir" ]; then
		output="$outdir/$(basename "$basename").mp4"
	else
		output="${basename}.mp4"
	fi

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
fi
