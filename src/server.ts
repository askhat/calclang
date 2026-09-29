import index from "../frontend/index.html"

const port = Number(process.env["PORT"] ?? 3000)
// `tauri android|ios dev` sets TAURI_DEV_HOST to the machine's LAN address so
// the device/emulator can reach the dev server; bind to it when present.
const hostname = process.env["TAURI_DEV_HOST"] || undefined

const server = Bun.serve({
  port,
  hostname,
  development: {
    hmr: true,
    console: true,
  },
  routes: {
    "/": index,
  },
})

console.log(`calc UI: ${server.url}`)
