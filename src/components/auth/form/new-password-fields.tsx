'use client';

import { useAuth } from '@better-auth-ui/react';
import type { ReactNode } from 'react';

import {
  getPasswordLengthProps,
  validateConfirmPassword,
  validatePasswordLength,
} from '@/lib/auth/auth-validation';
import { withAuthFieldGroup } from './auth-form';

type NewPasswordFieldsProps = {
  label: ReactNode;
  placeholder: string;
  disabled?: boolean;
  /** Renders skeletons in place of the inputs while the data they depend on loads. */
  isLoading?: boolean;
  /** Shows the compromised-password error against the password field. */
  isCompromised?: boolean;
  onPasswordChange?: () => void;
};

/**
 * New password with strength meter, plus a confirmation field when
 * `emailAndPassword.confirmPassword` is on. Map it onto any two string fields:
 * `fields={{ password: 'newPassword', confirmPassword: 'confirmPassword' }}`.
 */
export const NewPasswordFields = withAuthFieldGroup({
  defaultValues: { password: '', confirmPassword: '' },
  props: {} as NewPasswordFieldsProps,
  render: function NewPasswordFieldsRender({
    group,
    label,
    placeholder,
    disabled,
    isLoading,
    isCompromised,
    onPasswordChange,
  }) {
    const { emailAndPassword, localization } = useAuth();
    const inputProps = {
      autoComplete: 'new-password',
      required: true,
      disabled,
      isLoading,
      ...getPasswordLengthProps(emailAndPassword),
    };

    return (
      <>
        <group.AppField
          name="password"
          validators={{
            onChange: ({ value }) =>
              validatePasswordLength(value, emailAndPassword, localization.auth),
          }}
        >
          {(field) => (
            <field.AuthFormPasswordField
              {...inputProps}
              label={label}
              placeholder={placeholder}
              error={isCompromised ? localization.auth.passwordCompromised : undefined}
              onValueChange={onPasswordChange}
              showStrength
            />
          )}
        </group.AppField>

        {emailAndPassword?.confirmPassword && (
          <group.AppField
            name="confirmPassword"
            validators={{
              onChangeListenTo: ['password'],
              onChange: ({ value }) =>
                validateConfirmPassword(
                  value,
                  group.getFieldValue('password'),
                  emailAndPassword,
                  localization.auth,
                ),
            }}
          >
            {(field) => (
              <field.AuthFormPasswordField
                {...inputProps}
                label={localization.auth.confirmPassword}
                placeholder={localization.auth.confirmPasswordPlaceholder}
              />
            )}
          </group.AppField>
        )}
      </>
    );
  },
});
