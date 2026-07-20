import type { Metadata } from 'next';
import DashboardPage from '@/features/dashboard/DashboardPage'

export const metadata: Metadata = { title: 'Dashboard | NIVA CRM' };

export default function Dashboard() {
    return <DashboardPage />
}
