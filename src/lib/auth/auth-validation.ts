import {
  validateEmailAddress,
  validateMatchingValue,
  validateStringLength,
} from '@better-auth-ui/core';

type PasswordPolicy = { minPasswordLength: number; maxPasswordLength: number } | undefined;

type ValidationMessages = {
  fieldRequired: string;
  invalidEmail: string;
  passwordsDoNotMatch: string;
  tooLong: string;
  tooShort: string;
};

export function validatePasswordLength(
  value: string,
  policy: PasswordPolicy,
  messages: Pick<ValidationMessages, 'tooShort' | 'tooLong' | 'fieldRequired'>,
  currentPassword = false,
) {
  return validateStringLength(value, {
    maxLength: policy?.maxPasswordLength,
    maxLengthMessage: messages.tooLong.replace('{{max}}', String(policy?.maxPasswordLength)),
    ...(currentPassword
      ? {}
      : {
          minLength: policy?.minPasswordLength,
          minLengthMessage: messages.tooShort.replace('{{min}}', String(policy?.minPasswordLength)),
        }),
    requiredMessage: messages.fieldRequired,
  });
}

/** Length rules first, then the match against the password being confirmed. */
export function validateConfirmPassword(
  value: string,
  password: string,
  policy: PasswordPolicy,
  messages: Pick<
    ValidationMessages,
    'tooShort' | 'tooLong' | 'fieldRequired' | 'passwordsDoNotMatch'
  >,
) {
  return (
    validatePasswordLength(value, policy, messages) ??
    validateMatchingValue(value, password, messages.passwordsDoNotMatch)
  );
}

export function validateEmail(
  value: string,
  messages: Pick<ValidationMessages, 'invalidEmail' | 'fieldRequired'>,
) {
  return validateEmailAddress(value, {
    invalidMessage: messages.invalidEmail,
    requiredMessage: messages.fieldRequired,
  });
}

/** Native `minLength` / `maxLength` attributes matching the configured password policy. */
export function getPasswordLengthProps(policy: PasswordPolicy) {
  return { minLength: policy?.minPasswordLength, maxLength: policy?.maxPasswordLength };
}
