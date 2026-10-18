'use client';
export function AdminState({
  action,
  description,
  icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex min-h-list-max flex-col items-center justify-center gap-md rounded-lg border border-dashed p-2xl text-center">
      <span className="text-muted-foreground [&>svg]:size-2xl">{icon}</span>
      <div className="flex flex-col gap-2xs">
        <h2 className="font-medium">{title}</h2>
        <p className="max-w-form text-body-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
