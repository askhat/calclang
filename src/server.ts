import index from "../frontend/index.html"

const port = Number(process.env["PORT"] ?? 3000)

const server = Bun.serve({
  port,
  development: {
    hmr: true,
    console: true,
  },
  routes: {
    "/": index,
  },
})

console.log(`calc UI: ${server.url}`)
