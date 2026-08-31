import type { Metadata } from 'next';
import RoadmapPage from '@/features/roadmap/RoadmapPage';

export const metadata: Metadata = { title: 'Roadmap do time | NIVA CRM' };

export default function Roadmap() {
  return <RoadmapPage />;
}
