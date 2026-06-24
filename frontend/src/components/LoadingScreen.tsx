export function LoadingScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-zinc-100">Preparing World</h2>
        <p className="mt-1 text-sm text-zinc-400">Scanning mod textures for block colors…</p>
      </div>

      <div className="w-full max-w-md">
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full w-1/3 rounded-full bg-emerald-500 animate-[slide_1.4s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  )
}
