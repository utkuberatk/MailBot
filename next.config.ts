import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Prisma Client generated dosyalari sunucu tarafinda paketlenmemeli.
  serverExternalPackages: ['@prisma/adapter-better-sqlite3', 'better-sqlite3'],
}

export default nextConfig
