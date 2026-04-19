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
    errors = validate_config(config, require_all=True)
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

    errors = validate_config(config, require_all=True)
    if errors:
        click.echo("Configuration errors:", err=True)
        for error in errors:
            click.echo(f"  - {error}", err=True)
        sys.exit(1)

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

    with Status("[cyan]Fetching running instances...", console=console):
        try:
            instances = api.get_instances()
            running = [i for i in instances if i.lifecycle_state == "RUNNING"]
            
            if running:
                instances_table = Table(title="Running Instances", box=SIMPLE_HEAVY)
                instances_table.add_column("Name", style="cyan", no_wrap=True)
                instances_table.add_column("Shape", style="white")
                instances_table.add_column("IP", style="green")
                instances_table.add_column("ID", style="dim")
                
                for inst in running:
                    ip = ""
                    try:
                        vnics = api.get_instance_vnics(inst.id)
                        if vnics:
                            vnic_details = api.get_vnic(vnics[0].vnic_id)
                            if hasattr(vnic_details, 'public_ip') and vnic_details.public_ip:
                                ip = vnic_details.public_ip
                            elif hasattr(vnic_details, 'private_ip') and vnic_details.private_ip:
                                ip = vnic_details.private_ip
                    except Exception:
                        pass
                    
                    instances_table.add_row(
                        inst.display_name or "N/A",
                        inst.shape,
                        ip,
                        inst.id[:20] + "..." if len(inst.id) > 20 else inst.id
                    )
                
                console.print(Panel(instances_table, border_style="green"))
            else:
                console.print("[yellow]No running instances found[/yellow]")
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

                images_content = ""
                
                if ubuntu_images:
                    images_content += "[bold cyan]Ubuntu:[/bold cyan]\n"
                    for image in ubuntu_images:
                        images_content += f"  [white]{image.display_name}[/white]\n"
                        images_content += f"    [dim]{image.id}[/dim]\n"
                
                if oracle_images:
                    images_content += "\n[bold]Oracle Linux:[/bold]\n"
                    for image in oracle_images[:5]:
                        images_content += f"  [white]{image.display_name}[/white]\n"
                        images_content += f"    [dim]{image.id}[/dim]\n"
                    if len(oracle_images) > 5:
                        images_content += f"  [dim]... and {len(oracle_images) - 5} more[/dim]\n"
                
                if other_images:
                    images_content += "\n[bold]Other:[/bold]\n"
                    for image in other_images[:10]:
                        images_content += f"  [white]{image.display_name}[/white]\n"
                        images_content += f"    [dim]{image.id}[/dim]\n"
                    if len(other_images) > 10:
                        images_content += f"  [dim]... and {len(other_images) - 10} more[/dim]\n"
                
                console.print(Panel(images_content.strip(), title="Images", border_style="cyan"))
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
@click.pass_context
@click.option("--shape", default=None, help="Filter by shape")
@click.option("--state", default=None, help="Filter by state")
def vm_list(ctx, shape: str | None, state: str | None):
    """List all instances in the compartment."""
    env_file = ctx.obj.get("env_file", ".env")
    config = load_config(env_file)

    errors = validate_config(config, require_all=True)
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

    click.echo(f"{'Name':<30} {'Shape':<25} {'State':<15} {'IP':<18} {'ID':<30}")
    click.echo("-" * 120)
    for inst in instances:
        ip = ""
        try:
            vnics = api.get_instance_vnics(inst.id)
            if vnics:
                vnic_details = api.get_vnic(vnics[0].vnic_id)
                if hasattr(vnic_details, 'public_ip') and vnic_details.public_ip:
                    ip = vnic_details.public_ip
                elif hasattr(vnic_details, 'private_ip') and vnic_details.private_ip:
                    ip = vnic_details.private_ip
        except Exception:
            pass
        click.echo(f"{inst.display_name:<30} {inst.shape:<25} {inst.lifecycle_state:<15} {ip:<18} {inst.id[:30]:<30}")


@vm.command("create")
@click.pass_context
@click.option("--loop", "loop_mode", is_flag=True, help="Run in loop mode until instance is created")
@click.option("--loop-min", default=60, type=int, help="Min loop interval in seconds")
@click.option("--loop-max", default=120, type=int, help="Max loop interval in seconds")
def vm_create(ctx, loop_mode: bool, loop_min: int, loop_max: int):
    """Create a new instance."""
    env_file = ctx.obj.get("env_file", ".env")
    config = load_config(env_file)

    errors = validate_config(config, require_all=True)
    if errors:
        click.echo("Configuration errors:", err=True)
        for error in errors:
            click.echo(f"  - {error}", err=True)
        sys.exit(1)

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
@click.pass_context
@click.argument("instance_id")
def vm_get(ctx, instance_id: str):
    """Get details of a specific instance."""
    env_file = ctx.obj.get("env_file", ".env")
    config = load_config(env_file)

    errors = validate_config(config, require_all=True)
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
@click.pass_context
def vm_list_ads(ctx):
    """List availability domains."""
    env_file = ctx.obj.get("env_file", ".env")
    config = load_config(env_file)

    errors = validate_config(config, require_all=True)
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
@click.pass_context
def vm_list_shapes(ctx):
    """List available shapes in the region."""
    env_file = ctx.obj.get("env_file", ".env")
    config = load_config(env_file)

    errors = validate_config(config, require_all=True)
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


@cli.group("keys")
def keys():
    """OCI API key management."""
    pass


@keys.command("generate")
@click.option(
    "--key-name",
    default=None,
    prompt=False,
    help="Key name (default: oci_api_key)",
)
def keys_generate(key_name: str | None):
    """Generate RSA key pair for OCI API signing."""
    import subprocess

    default_name = "oci_api_key"

    while True:
        if key_name is None:
            prompt_name = click.prompt(
                "Key name",
                default=default_name,
                type=str,
            )
        else:
            prompt_name = key_name
            key_name = None

        oci_dir = Path.home() / ".oci"
        private_key_path = oci_dir / f"{prompt_name}.pem"
        public_key_path = oci_dir / f"{prompt_name}.public.pem"

        if private_key_path.exists() or public_key_path.exists():
            click.echo(f"[red]Error:[/red] Key files already exist:", err=True)
            click.echo(f"  Private: {private_key_path}", err=True)
            click.echo(f"  Public:  {public_key_path}", err=True)
            click.echo()
            prompt_name = click.prompt("Enter a different key name", default=default_name, type=str)
            continue

        break

    oci_dir.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        ["openssl", "genrsa", "-out", str(private_key_path), "2048"],
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        click.echo(f"[red]Error:[/red] {result.stderr}", err=True)
        sys.exit(1)

    result = subprocess.run(
        ["openssl", "rsa", "-pubout", "-in", str(private_key_path), "-out", str(public_key_path)],
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        click.echo(f"[red]Error:[/red] {result.stderr}", err=True)
        private_key_path.unlink(missing_ok=True)
        sys.exit(1)

    private_key_path.chmod(0o600)

    # Generate both fingerprints
    import hashlib
    
    # Standard fingerprint (for reference)
    result_std = subprocess.run(
        ["openssl", "rsa", "-in", str(private_key_path), "-pubout"],
        capture_output=True, text=True
    )
    std_fp = hashlib.md5(result_std.stdout.encode()).hexdigest()
    std_fp_formatted = ":".join(std_fp[i:i+2] for i in range(0, len(std_fp), 2))
    
    # OCI fingerprint (DER format - what OCI uses)
    result_der = subprocess.run(
        ["openssl", "rsa", "-in", str(private_key_path), "-pubout", "-outform", "DER"],
        capture_output=True
    )
    oci_fp = hashlib.md5(result_der.stdout).hexdigest()
    oci_fp_formatted = ":".join(oci_fp[i:i+2] for i in range(0, len(oci_fp), 2))

    console.print(Panel(
        f"[green]✓[/green] Keys generated successfully!\n\n"
        f"[bold]Private key:[/bold] {private_key_path}\n"
        f"[bold]Public key:[/bold]  {public_key_path}\n\n"
        f"[bold]Fingerprints:[/bold]\n"
        f"  Standard (SSH/API): {std_fp_formatted}\n"
        f"  [bold]OCI (use this):[/bold] {oci_fp_formatted}\n\n"
        f"[dim]Upload the public key to OCI console → Identity → Users → API Keys[/dim]",
        title="[bold]Keys Created[/bold]",
        border_style="green"
    ))


def main():
    cli(obj={})


if __name__ == "__main__":
    main()