FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

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
