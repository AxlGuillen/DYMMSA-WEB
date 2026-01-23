export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <main className="flex flex-col items-center gap-8 p-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          DYMMSA
        </h1>
        <p className="text-xl text-muted-foreground">
          Sistema de Cotizaciones
        </p>
        <div className="mt-4 rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <p className="text-sm text-muted-foreground">
            Fase 0 completada - Setup inicial listo
          </p>
        </div>
      </main>
    </div>
  );
}
