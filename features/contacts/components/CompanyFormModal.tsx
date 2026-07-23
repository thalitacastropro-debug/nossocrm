import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Company } from '@/types';
import { Modal, ModalForm } from '@/components/ui/Modal';
import { InputField, SubmitButton } from '@/components/ui/FormField';
import { companyFormSchema } from '@/lib/validations/schemas';
import type { CompanyFormData } from '@/lib/validations/schemas';

type CompanyFormInput = z.input<typeof companyFormSchema>;

interface CompanyFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CompanyFormData) => void;
  editingCompany: Company | null;
}

/**
 * Componente React `CompanyFormModal`.
 *
 * @param {CompanyFormModalProps} {
  isOpen,
  onClose,
  onSubmit,
  editingCompany,
} - Parâmetro `{
  isOpen,
  onClose,
  onSubmit,
  editingCompany,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const CompanyFormModal: React.FC<CompanyFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  editingCompany,
}) => {
  const form = useForm<CompanyFormInput>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: {
      name: editingCompany?.name || '',
      industry: editingCompany?.industry || '',
      website: editingCompany?.website || '',
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = form;

  React.useEffect(() => {
    if (isOpen) {
      reset({
        name: editingCompany?.name || '',
        industry: editingCompany?.industry || '',
        website: editingCompany?.website || '',
      });
    }
  }, [isOpen, editingCompany, reset]);

  const handleFormSubmit = (data: CompanyFormInput) => {
    const parsed = companyFormSchema.parse(data);
    onSubmit(parsed);
    onClose();
    reset();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingCompany ? 'Editar Empresa' : 'Nova Empresa'}
    >
      <ModalForm onSubmit={handleSubmit(handleFormSubmit)}>
        <InputField
          label="Nome"
          placeholder="Ex: Acme Ltda"
          required
          error={errors.name}
          registration={register('name')}
        />

        <InputField
          label="Setor"
          placeholder="Ex: SaaS"
          error={errors.industry}
          registration={register('industry')}
        />

        <InputField
          label="Website"
          placeholder="empresa.com"
          hint="Sem http(s) (vamos normalizar automaticamente)."
          error={errors.website}
          registration={register('website')}
        />

        <SubmitButton isLoading={isSubmitting}>
          {editingCompany ? 'Salvar Alterações' : 'Criar Empresa'}
        </SubmitButton>
      </ModalForm>
    </Modal>
  );
};

