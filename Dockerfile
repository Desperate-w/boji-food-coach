FROM node:24-bookworm-slim AS checked
WORKDIR /app
COPY package.json *.js *.html *.css ./
RUN npm test

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY --from=checked --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
