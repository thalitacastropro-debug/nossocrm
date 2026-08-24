'use client'

import React, { useEffect } from 'react';
import { useBoardsController } from './hooks/useBoardsController';
import { PipelineView } from './components/PipelineView';
import { OnboardingModal } from '@/components/OnboardingModal';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { useAuth } from '@/context/AuthContext';

/**
 * Componente React `BoardsPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BoardsPage: React.FC = () => {
    const controller = useBoardsController();
    const { isFirstVisit, completeOnboarding } = useFirstVisit();
    const { profile } = useAuth();
    const [showOnboarding, setShowOnboarding] = React.useState(false);

    // Lista vazia tem DOIS significados desde o acesso por funil: org sem funil
    // nenhum (é o caso do onboarding) ou pessoa sem funil liberado. Só admin cria
    // funil, então para os demais o convite "crie seu primeiro funil" é um beco.
    const podeCriarFunil = profile?.role === 'admin';

    // Show onboarding modal on first visit IF there are no boards
    // Only decide after boards have been fetched at least once
    useEffect(() => {
        // Wait until boards query has completed at least once
        if (!controller.boardsFetched) return;

        if (isFirstVisit && controller.boards.length === 0 && podeCriarFunil) {
            const timer = setTimeout(() => {
                setShowOnboarding(true);
            }, 500);
            return () => clearTimeout(timer);
        } else if (isFirstVisit && controller.boards.length > 0) {
            // If first visit but has boards, mark as completed silently
            completeOnboarding();
        }
    }, [isFirstVisit, controller.boards.length, controller.boardsFetched, completeOnboarding, podeCriarFunil]);

    const handleOnboardingStart = () => {
        setShowOnboarding(false);
        completeOnboarding();
        // Open wizard automatically
        controller.setIsWizardOpen(true);
    };

    const handleOnboardingSkip = () => {
        setShowOnboarding(false);
        completeOnboarding();
    };

    if (controller.boardsFetched && controller.boards.length === 0 && !podeCriarFunil) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="text-center max-w-sm">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                        Nenhum funil liberado
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400">
                        Seu acesso ainda não inclui nenhum funil. Peça ao administrador para liberar
                        os funis da sua área em Configurações → Equipe.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <>
            <PipelineView {...controller} />

            <OnboardingModal
                isOpen={showOnboarding}
                onStart={handleOnboardingStart}
                onSkip={handleOnboardingSkip}
            />
        </>
    );
};

// @deprecated - Use BoardsPage
export const PipelinePage = BoardsPage;
