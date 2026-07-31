import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex h-full items-center justify-center bg-void px-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-10 flex items-baseline justify-between border-b border-hair pb-3">
          <h1 className="text-[15px] tracking-[0.32em] text-bright">TEMPO</h1>
          <span className="label">{'// LOCKED'}</span>
        </div>
        <LoginForm />
        <p className="label mt-10 leading-relaxed">
          Single account. No registration.
        </p>
      </div>
    </main>
  );
}
