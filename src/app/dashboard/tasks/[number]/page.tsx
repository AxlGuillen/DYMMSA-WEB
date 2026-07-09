'use client'

import { use } from 'react'
import { TaskDetail } from '@/components/tasks/TaskDetail'

export default function TaskDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params)
  const n = parseInt(number, 10)
  return <TaskDetail number={n} />
}
