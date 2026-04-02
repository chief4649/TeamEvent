FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY extract_team_matches.js ./
COPY server.js ./
COPY translations.ja.json ./
COPY rules.json ./
COPY public ./public
COPY .cache ./.cache

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "server.js"]
