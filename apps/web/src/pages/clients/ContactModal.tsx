import { zodResolver } from '@hookform/resolvers/zod';
import { contactSchema, type ContactDto, type ContactInput } from '@xc8/shared';
import { Button, Form, Modal } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { saveErrorMessage } from '../../api/client';
import { useSaveContact } from '../../api/hooks';

/**
 * Add or edit a contact from the client's Contacts tab. The client is set automatically
 * (FR-CLI-10) and contacts never get a login (FR-CLI-03/07).
 */
export function ContactModal({
  clientId,
  clientName,
  contact,
  onClose,
}: {
  clientId: string;
  clientName: string;
  contact: ContactDto | null;
  onClose: () => void;
}) {
  const save = useSaveContact();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: contact?.name ?? '',
      position: contact?.position ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      department: contact?.department ?? '',
      notes: contact?.notes ?? '',
    },
  });
  const onSubmit = handleSubmit(async (body) => {
    try {
      await save.mutateAsync({ id: contact?.id, clientId, body });
      onClose();
    } catch (e) {
      setError('root', { message: saveErrorMessage(e) });
    }
  });
  return (
    <Modal show onHide={onClose} centered aria-labelledby="contact-modal-title">
      <Form noValidate onSubmit={(e) => void onSubmit(e)}>
        <Modal.Header closeButton>
          <Modal.Title as="h5" id="contact-modal-title">
            {contact ? `Edit ${contact.name}` : `Add contact to ${clientName}`}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3" controlId="contact-name">
            <Form.Label>Full name *</Form.Label>
            <Form.Control {...register('name')} isInvalid={!!errors.name} />
            <Form.Control.Feedback type="invalid">{errors.name?.message}</Form.Control.Feedback>
          </Form.Group>
          <Form.Group className="mb-3" controlId="contact-position">
            <Form.Label>Position</Form.Label>
            <Form.Control {...register('position')} />
          </Form.Group>
          <div className="row">
            <Form.Group className="mb-3 col-sm-6" controlId="contact-email">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" {...register('email')} isInvalid={!!errors.email} />
              <Form.Control.Feedback type="invalid">{errors.email?.message}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="mb-3 col-sm-6" controlId="contact-phone">
              <Form.Label>Phone</Form.Label>
              <Form.Control {...register('phone')} />
            </Form.Group>
          </div>
          <Form.Group className="mb-3" controlId="contact-dept">
            <Form.Label>Department</Form.Label>
            <Form.Control {...register('department')} />
          </Form.Group>
          <Form.Group className="mb-3" controlId="contact-notes">
            <Form.Label>Notes</Form.Label>
            <Form.Control as="textarea" rows={2} {...register('notes')} />
          </Form.Group>
          <p className="small text-body-secondary mb-0">
            The client is set automatically. Contacts never get a login.
          </p>
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
            Save contact
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
