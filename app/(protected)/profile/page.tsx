import type { Metadata } from 'next';
import { ProfilePage } from '@/features/profile/ProfilePage'

export const metadata: Metadata = { title: 'Perfil | NIVA CRM' };

export default function Profile() {
    return <ProfilePage />
}
