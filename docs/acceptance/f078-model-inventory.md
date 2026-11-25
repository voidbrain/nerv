# F-078-T01: model and hardware inventory

Read-only: nothing is installed, downloaded or changed. Paste the output into the F-078 record or a message; the agent fills the matrix (F-078-T02) from it. Alternatively, say "the agent may run the Tabgha inventory over SSH once" and it runs the same commands.

## Neo Tokyo-3 (macOS Terminal)

```bash
ollama list
sysctl -n hw.memsize | awk '{print $1/1073741824 " GB"}'
sysctl -n machdep.cpu.brand_string
```

Expected: the installed models with their sizes (`gemma4:12b` at about 8 GB is known), the memory in GB, and the Apple chip name.

## Tabgha, NERV-02 (PowerShell)

```powershell
ollama list
"{0:N0} GB" -f ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name
Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM
```

Expected: the installed models (the owner reports `qwen2.5-coder:14b`), the memory in GB, the CPU, and the GPU name if there is one. A model larger than about two thirds of the memory (or of the GPU memory, if it runs there) will be slow or will not load.
