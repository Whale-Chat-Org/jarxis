'use client';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { useAuth } from '@better-auth-ui/react';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';

/** Registry input-group composition shared by all password fields, with localized toggle labels. */
export function PasswordInput(props: Omit<ComponentProps<typeof InputGroupInput>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const { localization } = useAuth();
  const label = visible ? localization.auth.hidePassword : localization.auth.showPassword;
  return (
    <InputGroup>
      <InputGroupInput {...props} type={visible ? 'text' : 'password'} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          type="button"
          size="icon-xs"
          disabled={props.disabled}
          aria-label={label}
          title={label}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
