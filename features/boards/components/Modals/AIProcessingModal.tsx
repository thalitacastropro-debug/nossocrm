import React from 'react';
import { Loader2, CheckCircle2, Circle, Sparkles, BrainCircuit, LayoutTemplate, Target, Eye, BookOpen } from 'lucide-react';

export type ProcessingStep = 'analyzing' | 'structure' | 'strategy' | 'finalizing' | 'complete';
export type SimulatorPhase = 'structure' | 'strategy';

interface AIProcessingModalProps {
    isOpen: boolean;
    currentStep: ProcessingStep;
    phase?: SimulatorPhase;
}

/**
 * Componente React `AIProcessingModal`.
 *
 * @param {AIProcessingModalProps} { isOpen, currentStep, phase = 'structure' } - Parâmetro `{ isOpen, currentStep, phase = 'structure' }`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export const AIProcessingModal: React.FC<AIProcessingModalProps> = ({ isOpen, currentStep, phase = 'structure' }) => {
    if (!isOpen) return null;

    // Define steps based on phase
    const structureSteps = [
        {
            id: 'analyzing',
            label: 'Analisando seu negócio...',
            icon: BrainCircuit,
            description: 'Entendendo o contexto e necessidades.'
        },
        {
            id: 'structure',
            label: 'Desenhando Processo',
            icon: LayoutTemplate,
            description: 'Criando fases do funil e automações.'
        },
        {
            id: 'finalizing',
            label: 'Preparando Preview...',
            icon: Eye,
            description: 'Gerando visualização interativa.'
        }
    ];

    const strategySteps = [
        {
            id: 'analyzing', // Reusing ID for simplicity in state mapping
            label: 'Lendo Contexto do Funil...',
            icon: BookOpen,
            description: 'Analisando a estrutura final aprovada.'
        },
        {
            id: 'strategy',
            label: 'Definindo Estratégia',
            icon: Target,
            description: 'Configurando metas e persona do agente.'
        },
        {
            id: 'finalizing',
            label: 'Finalizando Criação...',
            icon: Sparkles,
            description: 'Montando seu funil personalizado.'
        }
    ];

    const steps = phase === 'structure' ? structureSteps : strategySteps;

    const getCurrentStepIndex = () => {
        if (currentStep === 'complete') return steps.length;

        // Map generic steps to specific phase steps
        // For strategy phase, 'analyzing' maps to the first step (Reading Context)
        return steps.findIndex(s => s.id === currentStep);
    };

    const activeIndex = getCurrentStepIndex();

    return (
        <div className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center">
            {/* Glassmorphism Background */}
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xl transition-opacity duration-500" />

            <div className="relative z-10 w-full max-w-md bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] border border-white/40 dark:border-white/20 overflow-hidden transform transition-all duration-500 scale-100">
                {/* Header */}
                <div className="p-8 bg-gradient-to-b from-white/50 to-transparent dark:from-white/5 border-b border-slate-100/50 dark:border-white/5 text-center">
                    <div className="w-16 h-16 bg-gradient-to-tr from-primary-100 to-blue-50 dark:from-primary-900/30 dark:to-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-5 shadow-inner ring-1 ring-white/50 dark:ring-white/10">
                        <Sparkles className="text-primary-600 dark:text-primary-400 animate-pulse drop-shadow-sm" size={32} />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                        {phase === 'structure' ? 'Criando seu CRM' : 'Definindo Estratégia'}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium">
                        {phase === 'structure' ? 'A IA está desenhando seu processo...' : 'A IA está alinhando metas e agentes...'}
                    </p>
                </div>

                {/* Steps */}
                <div className="p-8 space-y-7">
                    {steps.map((step, idx) => {
                        const isActive = idx === activeIndex;
                        const isCompleted = idx < activeIndex;
                        const isPending = idx > activeIndex;

                        return (
                            <div key={step.id} className={`flex items-start gap-4 transition-all duration-500 ${isPending ? 'opacity-40 blur-[0.5px]' : 'opacity-100'}`}>
                                <div className="shrink-0 mt-1 relative">
                                    {isCompleted ? (
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-green-500 blur-sm opacity-20 rounded-full" />
                                            <CheckCircle2 className="text-green-500 relative z-10" size={22} />
                                        </div>
                                    ) : isActive ? (
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-primary-500 blur-md opacity-40 rounded-full animate-pulse" />
                                            <Loader2 className="text-primary-600 dark:text-primary-400 animate-spin relative z-10" size={22} />
                                        </div>
                                    ) : (
                                        <Circle className="text-slate-300 dark:text-slate-600" size={22} />
                                    )}
                                </div>
                                <div className="flex-1">
                                    <h4 className={`font-semibold text-base transition-colors duration-300 ${isActive ? 'text-primary-600 dark:text-primary-400' : 'text-slate-900 dark:text-white'}`}>
                                        {step.label}
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                        {step.description}
                                    </p>
                                </div>
                                <div className={`p-2.5 rounded-xl transition-colors duration-300 ${isActive ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 shadow-sm ring-1 ring-primary-100 dark:ring-primary-500/30' : 'bg-slate-50 dark:bg-white/5 text-slate-400'}`}>
                                    <step.icon size={18} />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Progress Bar */}
                <div className="h-1.5 bg-slate-100 dark:bg-white/5 w-full">
                    <div
                        className="h-full bg-gradient-to-r from-primary-500 to-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)] transition-all duration-700 ease-out"
                        style={{ width: `${((activeIndex + 0.5) / steps.length) * 100}%` }}
                    />
                </div>
            </div>
        </div>
    );
};
