"""CLI entry point."""
import sys
from pathlib import Path

import click
from rich.console import Console
from rich.status import Status
from rich.table import Table
from rich.panel import Panel
from rich.box import SIMPLE_HEAVY

from vizoci.config import load_config, validate_discoverable, validate_config
from vizoci.instance import InstanceCreator, run_loop
from vizoci.oci_api import OCIApi
from vizoci.logging_utils import get_next_run

console = Console()


@click.group()
@click.option("--env-file", default=".env", help="Path to .env file")
@click.pass_context
def cli(ctx, env_file: str):
    """Vizoci - Oracle Cloud Infrastructure Instance Manager."""
    ctx.ensure_object(dict)
    ctx.obj["env_file"] = env_file
    ctx.obj["config"] = load_config(env_file)
    ctx.obj["run"] = get_next_run()


def get_api(ctx):
    """Get OCI API client, auto-discovering config if needed."""
    config = ctx.obj["config"]
    errors = validate_discoverable(config)
    if errors:
        click.echo("Configuration errors:", err=True)
        for error in errors:
            click.echo(f"  - {error}", err=True)
        sys.exit(1)
    return OCIApi(config.oci)


@cli.command()
@click.pass_context
def discover(ctx):
    """Auto-discover OCI configuration."""
    run = ctx.obj.get("run", 1)
    env_file = ctx.obj.get("env_file", ".env")
    config = load_config(env_file)
    api = OCIApi(config.oci)

    discovered = api.get_config()

    config_table = Table(title="OCI Configuration", box=SIMPLE_HEAVY, show_header=False)
    config_table.add_column("Key", style="bold cyan", width=20)
    config_table.add_column("Value", style="white")
    config_table.add_row("Tenancy ID", discovered.get("tenancy", ""))
    config_table.add_row("User ID", discovered.get("user", ""))
    config_table.add_row("Key Fingerprint", discovered.get("fingerprint", ""))
    config_table.add_row("Region", discovered.get("region", ""))
    console.print(Panel(config_table, title=f"[bold]OCI Configuration[/bold] [{run}]", border_style="cyan"))

    console.print()

    with Status("[cyan]Fetching tenancy info...", console=console):
        try:
            compartment = api.get_compartment()
            console.print(f"[green]✓[/green] Tenancy Name: [bold]{compartment.name}[/bold]")
        except Exception as e:
            console.print(f"[red]✗[/red] Error: {e}")

    console.print()

    with Status("[cyan]Fetching subnets...", console=console):
        try:
            subnets = api.list_subnets()
            if subnets:
                subnet_table = Table(title="Subnets", box=SIMPLE_HEAVY, min_width=80)
                subnet_table.add_column("Name", style="cyan", no_wrap=True)
                subnet_table.add_column("ID", style="dim")
                for subnet in subnets:
                    subnet_table.add_row(subnet.display_name, subnet.id)
                console.print(Panel(subnet_table, border_style="cyan"))
            else:
                console.print("[yellow]No subnets found[/yellow]")
        except Exception as e:
            console.print(f"[red]✗[/red] Error: {e}")

    console.print()

    with Status("[cyan]Fetching images...", console=console):
        try:
            images = api.list_images()
            if images:
                ubuntu_images = [i for i in images if "Ubuntu" in i.display_name]
                oracle_images = [i for i in images if "Oracle" in i.display_name and "Ubuntu" not in i.display_name]
                other_images = [i for i in images if "Ubuntu" not in i.display_name and "Oracle" not in i.display_name and "Windows" not in i.display_name]

                console.print("[bold]Images:[/bold]")
                
                if ubuntu_images:
                    console.print("\n  [bold cyan]Ubuntu:[/bold cyan]")
                    for image in ubuntu_images:
                        console.print(f"    [white]{image.display_name}[/white]")
                        console.print(f"      [dim]{image.id}[/dim]")
                
                if oracle_images:
                    console.print("\n  [bold]Oracle Linux:[/bold]")
                    for image in oracle_images[:5]:
                        console.print(f"    [white]{image.display_name}[/white]")
                        console.print(f"      [dim]{image.id}[/dim]")
                    if len(oracle_images) > 5:
                        console.print(f"    [dim]... and {len(oracle_images) - 5} more[/dim]")
                
                if other_images:
                    console.print("\n  [bold]Other:[/bold]")
                    for image in other_images[:10]:
                        console.print(f"    [white]{image.display_name}[/white]")
                        console.print(f"      [dim]{image.id}[/dim]")
                    if len(other_images) > 10:
                        console.print(f"    [dim]... and {len(other_images) - 10} more[/dim]")
            else:
                console.print("[yellow]No images found[/yellow]")
        except Exception as e:
            console.print(f"[red]✗[/red] Error: {e}")

    console.print()

    with Status("[cyan]Fetching shapes...", console=console):
        try:
            shapes = api.get_shapes()
            if shapes:
                always_free = [s for s in shapes if "A1" in s.shape or "E2.1.Micro" in s.shape]
                other = [s for s in shapes if s not in always_free]

                shape_table = Table(title="Shapes", box=SIMPLE_HEAVY)
                shape_table.add_column("Shape", style="cyan", no_wrap=True)
                shape_table.add_column("Type", style="dim")

                for shape in always_free:
                    shape_table.add_row(shape.shape, "Always Free")
                for shape in other[:10]:
                    shape_table.add_row(shape.shape, "Paid")
                if len(other) > 10:
                    shape_table.add_row(f"... {len(other) - 10} more", "")

                console.print(Panel(shape_table, border_style="cyan"))
            else:
                console.print("[yellow]No shapes found[/yellow]")
        except Exception as e:
            console.print(f"[red]✗[/red] Error: {e}")


@cli.group("vm")
def vm():
    """VM management commands."""
    pass


@vm.command("list")
@click.option("--shape", default=None, help="Filter by shape")
@click.option("--state", default=None, help="Filter by state")
def vm_list(shape: str | None, state: str | None):
    """List all instances in the compartment."""
    config = load_config(env_file)
    errors = validate_discoverable(config)
    if errors:
        click.echo("Configuration errors:", err=True)
        for error in errors:
            click.echo(f"  - {error}", err=True)
        sys.exit(1)

    api = OCIApi(config.oci)
    instances = api.get_instances()

    if shape:
        instances = [i for i in instances if i.shape == shape]
    if state:
        instances = [i for i in instances if i.lifecycle_state == state]

    if not instances:
        click.echo("No instances found.")
        return

    click.echo(f"{'Name':<30} {'Shape':<25} {'State':<15} {'ID':<50}")
    click.echo("-" * 120)
    for inst in instances:
        click.echo(f"{inst.display_name:<30} {inst.shape:<25} {inst.lifecycle_state:<15} {inst.id:<50}")


@vm.command("create")
@click.option("--loop", "loop_mode", is_flag=True, help="Run in loop mode until instance is created")
@click.option("--loop-min", default=60, type=int, help="Min loop interval in seconds")
@click.option("--loop-max", default=120, type=int, help="Max loop interval in seconds")
def vm_create(loop_mode: bool, loop_min: int, loop_max: int):
    """Create a new instance."""
    config = load_config(env_file)

    api = OCIApi(config.oci)

    if not config.oci.tenancy_id:
        config.oci.tenancy_id = api._config["tenancy"]
    if not config.oci.user_id:
        config.oci.user_id = api._config["user"]
    if not config.oci.key_fingerprint:
        config.oci.key_fingerprint = api._config["fingerprint"]

    errors = validate_config(config, require_all=False)
    if errors:
        click.echo("Configuration errors:", err=True)
        for error in errors:
            click.echo(f"  - {error}", err=True)
        sys.exit(1)

    if loop_mode:
        config.loop.enabled = True
        config.loop.interval_min = loop_min
        config.loop.interval_max = loop_max
        run_loop(config)
    else:
        creator = InstanceCreator(config)
        success = creator.run_once()
        sys.exit(0 if success else 1)


@vm.command("get")
@click.argument("instance_id")
def vm_get(instance_id: str):
    """Get details of a specific instance."""
    config = load_config(env_file)
    errors = validate_discoverable(config)
    if errors:
        click.echo("Configuration errors:", err=True)
        for error in errors:
            click.echo(f"  - {error}", err=True)
        sys.exit(1)

    api = OCIApi(config.oci)
    instance = api.get_instance(instance_id)

    click.echo(f"Instance Details:")
    click.echo(f"  ID: {instance.id}")
    click.echo(f"  Display Name: {instance.display_name}")
    click.echo(f"  Shape: {instance.shape}")
    click.echo(f"  State: {instance.lifecycle_state}")
    click.echo(f"  Availability Domain: {instance.availability_domain}")
    click.echo(f"  Compartment ID: {instance.compartment_id}")
    if instance.time_created:
        click.echo(f"  Created: {instance.time_created}")

    try:
        vnics = api.get_instance_vnics(instance_id)
        for vnic in vnics:
            vnic_details = api.get_vnic(vnic.vnic_id)
            if hasattr(vnic_details, 'private_ip') and vnic_details.private_ip:
                click.echo(f"  Private IP: {vnic_details.private_ip}")
            if hasattr(vnic_details, 'public_ip') and vnic_details.public_ip:
                click.echo(f"  Public IP: {vnic_details.public_ip}")
    except Exception:
        pass


@vm.command("list-ads")
def vm_list_ads():
    """List availability domains."""
    config = load_config(env_file)
    errors = validate_discoverable(config)
    if errors:
        click.echo("Configuration errors:", err=True)
        for error in errors:
            click.echo(f"  - {error}", err=True)
        sys.exit(1)

    api = OCIApi(config.oci)
    ads = api.get_availability_domains()

    click.echo(f"{'Name':<40} {'ID':<60}")
    click.echo("-" * 100)
    for ad in ads:
        click.echo(f"{ad.name:<40} {ad.id:<60}")


@vm.command("list-shapes")
def vm_list_shapes():
    """List available shapes in the region."""
    config = load_config(env_file)
    errors = validate_discoverable(config)
    if errors:
        click.echo("Configuration errors:", err=True)
        for error in errors:
            click.echo(f"  - {error}", err=True)
        sys.exit(1)

    api = OCIApi(config.oci)
    shapes = api.get_shapes()

    click.echo(f"{'Shape':<30} {'OCPUs':<10} {'Memory (GB)':<15}")
    click.echo("-" * 55)
    for shape in shapes:
        ocpus = shape.shape_config.ocpus if hasattr(shape, 'shape_config') and shape.shape_config else "?"
        memory = shape.shape_config.memory_in_gbs if hasattr(shape, 'shape_config') and shape.shape_config else "?"
        click.echo(f"{shape.shape:<30} {ocpus:<10} {memory:<15}")


def main():
    cli(obj={})


if __name__ == "__main__":
    main()