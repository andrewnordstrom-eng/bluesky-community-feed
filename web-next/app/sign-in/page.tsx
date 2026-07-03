"use client"

import { useState } from "react"
import { SignInDialog } from "@/components/sign-in-dialog"
import { Button } from "@/components/ui/button"

export default function SignInPreview() {
  const [open, setOpen] = useState(true)

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <Button onClick={() => setOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary-dark rounded-full px-5">
        Open sign-in dialog
      </Button>
      <SignInDialog open={open} onOpenChange={setOpen} />
    </main>
  )
}
