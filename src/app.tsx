import { useEffect } from 'react'
import device from '@/ts/device/device'

function App() {
  useEffect(() => {
    device.run()
  }, [])

  return (
    <div>
      <h1>gpuid-2d</h1>
      <canvas id="canvas" width="1000" height="1000"></canvas>
    </div>
  )
}

export default App
