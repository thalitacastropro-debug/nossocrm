import React, { useId } from 'react';
import { Sparkles, ArrowRight, X } from 'lucide-react';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';

interface OnboardingModalProps {
    isOpen: boolean;
    onStart: () => void;
    onSkip: () => void;
}

/**
 * OnboardingModal - Welcome modal for new users
 * 
 * Accessibility Features:
 * - role="dialog" for modal identification
 * - aria-labelledby for title
 * - aria-describedby for description
 * - Focus trap to keep keyboard focus within modal
 * - Escape key triggers skip
 */
export const OnboardingModal: React.FC<OnboardingModalProps> = ({
    isOpen,
    onStart,
    onSkip
}) => {
    const generatedId = useId();
    const titleId = `onboarding-title-${generatedId}`;
    const descId = `onboarding-desc-${generatedId}`;

    // Restore focus to trigger element on close
    useFocusReturn({ enabled: isOpen });

    if (!isOpen) return null;

    return (
        <FocusTrap
            active={isOpen}
            onEscape={onSkip}
            returnFocus={true}
            clickOutsideDeactivates={true}
        >
            <div
                className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center"
                role="presentation"
            >
                <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-md"
                    aria-hidden="true"
                    onClick={onSkip}
                />

                <div
                    className="relative z-10 w-full max-w-2xl mx-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    aria-describedby={descId}
                >
                    {/* Main Card */}
                    <div className="bg-gradient-to-br from-primary-500 to-primary-600 dark:from-primary-600 dark:to-primary-700 rounded-3xl shadow-2xl overflow-hidden">
                        {/* Skip Button */}
                        <button
                            type="button"
                            onClick={onSkip}
                            aria-label="Pular tutorial de boas-vindas"
                            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors focus-visible-ring"
                        >
                            <X size={20} aria-hidden="true" />
                        </button>

                        {/* Content */}
                        <div className="p-12 text-center text-white">
                            {/* Icon */}
                            <div
                                className="inline-flex items-center justify-center w-20 h-20 mb-6 bg-white/20 rounded-2xl backdrop-blur-sm"
                                aria-hidden="true"
                            >
                                <Sparkles size={40} className="text-white" />
                            </div>

                            {/* Title */}
                            <h1
                                id={titleId}
                                className="text-4xl font-bold mb-4"
                            >
                                Bem-vindo ao seu CRM! 👋
                            </h1>

                            {/* Description */}
                            <p
                                id={descId}
                                className="text-xl text-white/90 mb-8 max-w-xl mx-auto"
                            >
                                Vamos criar seu <strong>primeiro funil personalizado</strong> em menos de 30 segundos?
                            </p>

                            {/* Features */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 text-left" role="list" aria-label="Recursos do CRM">
                                <div className="p-4 bg-white/10 rounded-xl backdrop-blur-sm" role="listitem">
                                    <div className="text-2xl mb-2" aria-hidden="true">🎯</div>
                                    <h3 className="font-semibold mb-1">Templates Prontos</h3>
                                    <p className="text-sm text-white/80">Vendas, Onboarding, CS e mais</p>
                                </div>

                                <div className="p-4 bg-white/10 rounded-xl backdrop-blur-sm" role="listitem">
                                    <div className="text-2xl mb-2" aria-hidden="true">✨</div>
                                    <h3 className="font-semibold mb-1">Criação com IA</h3>
                                    <p className="text-sm text-white/80">Descreva seu negócio em 1 frase</p>
                                </div>

                                <div className="p-4 bg-white/10 rounded-xl backdrop-blur-sm" role="listitem">
                                    <div className="text-2xl mb-2" aria-hidden="true">⚡</div>
                                    <h3 className="font-semibold mb-1">Super Rápido</h3>
                                    <p className="text-sm text-white/80">Menos de 30 segundos</p>
                                </div>
                            </div>

                            {/* CTA Buttons */}
                            <div className="flex flex-col sm:flex-row gap-3 justify-center">
                                <button
                                    type="button"
                                    onClick={onStart}
                                    className="px-8 py-4 bg-white text-primary-600 font-bold rounded-xl hover:bg-white/90 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2 text-lg focus-visible-ring"
                                    autoFocus
                                >
                                    Começar agora
                                    <ArrowRight size={20} aria-hidden="true" />
                                </button>

                                <button
                                    type="button"
                                    onClick={onSkip}
                                    className="px-8 py-4 bg-white/10 text-white font-semibold rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm focus-visible-ring"
                                >
                                    Explorar por conta
                                </button>
                            </div>

                            {/* Small print */}
                            <p className="mt-6 text-sm text-white/60">
                                Você pode criar quantos funis quiser depois 😊
                            </p>
                        </div>
                    </div>

                    {/* Bottom gradient decoration */}
                    <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary-500/30 rounded-full blur-3xl -z-10" aria-hidden="true" />
                </div>
            </div>
        </FocusTrap>
    );
};
