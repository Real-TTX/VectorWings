# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS client
WORKDIR /src/VectorWings
COPY --from=matgame sdk/js /src/MatGame/sdk/js
COPY package*.json ./
RUN npm ci
COPY scripts/build-client.mjs scripts/
COPY src/client src/client/
RUN npm run build

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG Channel=local
ARG BuildNumber=0
ARG BuildDate
WORKDIR /src
COPY --from=matgame . MatGame/
COPY . VectorWings/
COPY --from=client /src/VectorWings/src/VectorWings.Module/wwwroot/ VectorWings/src/VectorWings.Module/wwwroot/
RUN find MatGame -type d \( -name bin -o -name obj -o -name node_modules \) -prune -exec rm -rf {} + && \
    dotnet publish MatGame/src/MatGame/MatGame.csproj -c Release -o /publish -p:UseAppHost=false \
      -p:MatGameGames=vectorwings -p:Channel="$Channel" -p:BuildNumber="$BuildNumber" \
      -p:BuildDate="${BuildDate:-$(date -u +%Y%m%d)}" && \
    test -f /publish/VectorWings.Module.dll && test -f /publish/wwwroot/vectorwings/vendor/flight-bundle.js

FROM mcr.microsoft.com/dotnet/aspnet:10.0
LABEL org.opencontainers.image.title="VectorWings" org.opencontainers.image.source="https://github.com/Real-TTX/VectorWings"
WORKDIR /app
ENV HTTP_PORTS="" ASPNETCORE_ENVIRONMENT=Production MATGAME_PORT=2776 MATGAME_GAMES=vectorwings TZ=Europe/Berlin
COPY --from=build /publish .
RUN mkdir -p /data/keys /data/games && chown -R $APP_UID:$APP_UID /data
VOLUME /data
USER $APP_UID
EXPOSE 2776
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=3 CMD ["dotnet","MatGame.dll","--healthcheck"]
ENTRYPOINT ["dotnet","MatGame.dll"]
