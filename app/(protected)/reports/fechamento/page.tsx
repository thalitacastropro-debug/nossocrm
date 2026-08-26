import type { Metadata } from 'next';
import FechamentoDoMesPage from '@/features/reports/FechamentoDoMesPage';

export const metadata: Metadata = { title: 'Fechamento do mês | NIVA CRM' };

export default function Fechamento() {
  return <FechamentoDoMesPage />;
}
