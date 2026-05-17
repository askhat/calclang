export async function runFile(path: string): Promise<void> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    console.error(`calc: file not found: ${path}`)
    process.exit(1)
  }
  const source = await file.text()
  process.stdout.write(source)
}
