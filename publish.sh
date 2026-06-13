#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Check if the version number argument is provided
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

VERSION=$1

docker buildx build --platform linux/amd64 -t harbor.alexklingenbeck.de/my/trackify:$VERSION . --push