#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: check-legal-docs.sh <legal-dir>" >&2
  exit 2
fi

legal_dir="$1"
tos_file="${legal_dir}/TERMS_OF_SERVICE.md"
privacy_file="${legal_dir}/PRIVACY_POLICY.md"

if [ ! -d "$legal_dir" ]; then
  echo "Missing legal directory: $legal_dir" >&2
  exit 1
fi

if [ ! -f "$tos_file" ] || [ -L "$tos_file" ] || [ ! -s "$tos_file" ]; then
  echo "Missing or empty $tos_file" >&2
  exit 1
fi

if [ ! -f "$privacy_file" ] || [ -L "$privacy_file" ] || [ ! -s "$privacy_file" ]; then
  echo "Missing or empty $privacy_file" >&2
  exit 1
fi

unexpected_file="$(find "$legal_dir" -mindepth 1 -maxdepth 1 ! -name TERMS_OF_SERVICE.md ! -name PRIVACY_POLICY.md -print -quit)"
if [ -n "$unexpected_file" ]; then
  echo "Unexpected file in $legal_dir: $unexpected_file" >&2
  exit 1
fi
