import { validateStringLength } from '@better-auth-ui/core';

export function validatePasswordLength(
  value: string,
  policy: { minPasswordLength: number; maxPasswordLength: number } | undefined,
  messages: { tooShort: string; tooLong: string; fieldRequired: string },
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
