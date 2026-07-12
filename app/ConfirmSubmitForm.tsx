"use client";

type Props = React.FormHTMLAttributes<HTMLFormElement> & {
  message: string;
};

export function ConfirmSubmitForm({ message, onSubmit, children, ...props }: Props) {
  return (
    <form
      {...props}
      onSubmit={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
          return;
        }
        onSubmit?.(event);
      }}
    >
      {children}
    </form>
  );
}
