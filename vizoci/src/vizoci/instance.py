"""Instance creation logic and loop runner."""
import random
import time
import datetime
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeRemainingColumn

from vizoci.config import Config, LoopConfig
from vizoci.oci_api import OCIApi
from vizoci.notifier import TelegramNotifier


class InstanceCreator:
    def __init__(self, config: Config):
        self.config = config
        self.api = OCIApi(config.oci)
        self.notifier = TelegramNotifier(config.telegram)

    def run_once(self) -> bool:
        """Attempt to create an instance once. Returns True if instance was created."""
        from rich.console import Console
        console = Console()
        
        console.print("[bold blue]Checking existing instances...[/bold blue]")
        instances = self.api.get_instances()

        existing = self.api.check_existing_instances(
            instances,
            self.config.oci.shape,
            self.config.oci.max_instances,
        )

        if existing:
            console.print(f"[yellow]Note: {existing}[/yellow]")
            console.print("[yellow]Proceeding with instance creation anyway...[/yellow]")

        console.print()
        console.print("[bold green]Instance Configuration:[/bold green]")
        console.print(f"  [cyan]Shape:[/cyan]   {self.config.oci.shape}")
        console.print(f"  [cyan]OCPUs:[/cyan]   {self.config.oci.ocpus}")
        console.print(f"  [cyan]Memory:[/cyan] {self.config.oci.memory_in_gbs} GB")
        console.print(f"  [cyan]Image:[/cyan]  [dim]{self.config.oci.image_id}[/dim]")
        console.print(f"  [cyan]Subnet:[/cyan] [dim]{self.config.oci.subnet_id}[/dim]")
        console.print()

        availability_domains = self._get_availability_domains()

        for ad in availability_domains:
            try:
                console.print(f"[bold]Trying availability domain:[/bold] {ad}...")
                result = self.api.create_instance(ad)
                instance_id = result.id if hasattr(result, 'id') else "unknown"
                console.print(f"[bold green]✓ Instance created successfully![/bold green]")
                console.print(f"  [cyan]Instance ID:[/cyan] {instance_id}")

                self._notify_success(result)
                return True

            except Exception as e:
                import json
                from rich.json import JSON
                error_str = str(e)
                
                # Try to parse as JSON - handle both JSON and Python dict string format
                parsed = None
                try:
                    parsed = json.loads(error_str)
                except json.JSONDecodeError:
                    # Try Python dict format (single quotes)
                    try:
                        import ast
                        parsed = ast.literal_eval(error_str)
                    except (ValueError, SyntaxError):
                        pass
                
                if parsed:
                    console.print("[red]Error:[/red]")
                    console.print(JSON(json.dumps(parsed, indent=2)))
                else:
                    console.print(f"[red]Error:[/red] {error_str}")

                # Recoverable errors - try next availability domain
                if any(x in error_str for x in [
                    "Out of host capacity",
                    "InternalError",
                    "NotAuthorizedOrNotFound",
                    "LimitExceeded",
                    "NotFound",
                ]):
                    sleep_time = random.randint(5, 25)
                    console.print(f"[yellow]No capacity in {ad}, waiting for next AD...[/yellow]")
                    with Progress(
                        SpinnerColumn(),
                        TextColumn("[progress.description]{task.description}"),
                        BarColumn(),
                        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
                        TimeRemainingColumn(),
                    ) as progress:
                        task = progress.add_task(f"Waiting {sleep_time}s", total=sleep_time)
                        for _ in range(sleep_time):
                            time.sleep(1)
                            progress.update(task, advance=1)
                    continue

                console.print(f"[bold red]✗ Non-recoverable error:[/bold red] {error_str}")
                return False

        console.print("[bold red]✗ Failed to create instance in all availability domains[/bold red]")
        return False

    def _get_availability_domains(self):
        if self.config.oci.availability_domain:
            return [self.config.oci.availability_domain]

        print("Fetching availability domains...")
        ads = self.api.get_availability_domains()
        ad_names = [ad.name for ad in ads]
        random.shuffle(ad_names)
        return ad_names

    def _notify_success(self, instance_result):
        from rich.console import Console
        console = Console()
        
        if not self.notifier.is_supported():
            console.print("[dim]Telegram not configured, skipping notification[/dim]")
            return

        msg = f"✅ *Instance Created!*\n\n"
        msg += f"ID: `{instance_result.id if hasattr(instance_result, 'id') else 'N/A'}`\n"
        msg += f"Shape: {instance_result.shape if hasattr(instance_result, 'shape') else 'N/A'}\n"
        msg += f"State: {instance_result.lifecycle_state if hasattr(instance_result, 'lifecycle_state') else 'N/A'}\n"
        msg += f"Time: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

        try:
            self.notifier.notify(msg)
            console.print("[green]✓ Notification sent successfully[/green]")
        except Exception as e:
            console.print(f"[red]Failed to send notification: {e}[/red]")


def run_loop(config: Config):
    """Run the instance creator in a loop."""
    from rich.console import Console
    from rich.table import Table
    console = Console()
    
    creator = InstanceCreator(config)
    loop_config = config.loop

    console.print(f"[bold cyan]Starting loop mode (interval: {loop_config.interval_min}-{loop_config.interval_max}s)[/bold cyan]")

    while True:
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        console.print(f"\n[bold blue]Current instances[/bold blue] [dim]({now})[/dim]:")
        instances = creator.api.get_instances()
        
        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("Name", style="cyan")
        table.add_column("Shape", style="yellow")
        table.add_column("State", style="green")
        table.add_column("AD", style="blue")
        
        for inst in instances:
            table.add_row(
                inst.display_name or "N/A",
                inst.shape or "N/A",
                inst.lifecycle_state or "N/A",
                inst.availability_domain or "N/A",
            )
        
        console.print(table)
        
        success = creator.run_once()

        if success:
            console.print("[bold green]✓ Instance created successfully![/bold green]")
            return  # Exit loop on success

        console.print("[yellow]No instance created, retrying...[/yellow]")

        sleep_time = random.randint(loop_config.interval_min, loop_config.interval_max)
        console.print(f"[cyan]Waiting {sleep_time}s before next attempt...[/cyan]")
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeRemainingColumn(),
        ) as progress:
            task = progress.add_task(f"Next attempt in {sleep_time}s", total=sleep_time)
            for _ in range(sleep_time):
                time.sleep(1)
                progress.update(task, advance=1)