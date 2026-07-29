FROM node:20-slim

# Install system packages + FRESH CA certificates
# ca-certificates fix: prevents "certificate has expired" when calling external APIs
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    && update-ca-certificates --fresh \
    && rm -rf /var/lib/apt/lists/*

# Keep Node.js using the system CA store (not its bundled old certs)
ENV NODE_OPTIONS=--use-openssl-ca

WORKDIR /app

COPY package.json ./

RUN npm install --production --legacy-peer-deps --ignore-scripts && \
    npm rebuild sharp

COPY . .

RUN mkdir -p tmp session data

# Railway sets PORT automatically; keep 1000 as fallback.
# start.js runs a health-check server on this port.
# The bot's own Express server still uses 8080 internally.
ENV PORT=1000
EXPOSE 1000

CMD ["node", "start.js"]
