import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NIVA CRM',
    short_name: 'NIVA CRM',
    description: 'CRM Inteligente para Gestão de Vendas',
    start_url: '/boards',
    display: 'standalone',
    background_color: '#0B1F3A',
    theme_color: '#0B1F3A',
    icons: [
      // Marca NIVA: escudo branco em quadrado navy (base-conhecimento-niva),
      // SVG com o escudo embutido (repo é text-only: *.png é gitignored).
      {
        src: '/brand/niva-symbol.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/brand/niva-symbol.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}

