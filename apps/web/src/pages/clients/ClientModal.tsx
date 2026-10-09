import { zodResolver } from '@hookform/resolvers/zod';
import { clientSchema, type ClientDto, type ClientInput } from '@xc8/shared';
import { Button, Form, Modal } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { ApiError, saveErrorMessage } from '../../api/client';
import { useSaveClient } from '../../api/hooks';

export function ClientModal({
  client,
  onClose,
}: {
  client: ClientDto | null;
  onClose: () => void;
}) {
  const save = useSaveClient();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name ?? '',
      industry: client?.industry ?? '',
      address: client?.address ?? '',
      notes: client?.notes ?? '',
    },
  });
  const onSubmit = handleSubmit(async (body) => {
    try {
      await save.mutateAsync({ id: client?.id, body });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'CLIENT_NAME_IN_USE' ? 'name' : 'root', {
        message: saveErrorMessage(e),
      });
    }
  });
  return (
    <Modal show onHide={onClose} centered>
      <Form noValidate onSubmit={(e) => void onSubmit(e)}>
        <Modal.Header closeButton>
          <Modal.Title as="h5">{client ? `Edit ${client.name}` : 'New client'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3" controlId="client-name">
            <Form.Label>Company name *</Form.Label>
            <Form.Control {...register('name')} isInvalid={!!errors.name} />
            <Form.Control.Feedback type="invalid">{errors.name?.message}</Form.Control.Feedback>
          </Form.Group>
          <Form.Group className="mb-3" controlId="client-industry">
            <Form.Label>Industry</Form.Label>
            <Form.Control {...register('industry')} />
          </Form.Group>
          <Form.Group className="mb-3" controlId="client-address">
            <Form.Label>Address</Form.Label>
            <Form.Control {...register('address')} />
          </Form.Group>
          <Form.Group controlId="client-notes">
            <Form.Label>Notes</Form.Label>
            <Form.Control as="textarea" rows={3} {...register('notes')} />
          </Form.Group>
          {errors.root && (
            <div className="text-danger small mt-2" role="alert">
              {errors.root.message}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
