use anyhow::{anyhow, Result};
use clap::Parser;
use dirs::home_dir;
use rand::RngCore;
use ssh_key::{Algorithm, LineEnding, PrivateKey};
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::time::Instant;

#[derive(Parser)]
#[command(name = "keyspace")]
#[command(about = "SSH vanity key generation tool")]
struct Args {
    /// Desired prefix for the public key
    #[arg(short, long)]
    prefix: String,

    /// Directory to save keys (default: ~/.ssh)
    #[arg(short, long)]
    dir: Option<PathBuf>,

    /// SSH key algorithm (default: ed25519)
    #[arg(long, default_value = "ed25519")]
    algorithm: String,

    /// Maximum number of attempts (default: 100000)
    #[arg(long, default_value = "100000")]
    max_attempts: u32,
}

fn main() -> Result<()> {
    let args = Args::parse();

    let algorithm = match args.algorithm.as_str() {
        "ed25519" => Algorithm::Ed25519,
        "rsa" => Algorithm::Rsa { hash: None },
        "ecdsa" => Algorithm::Ecdsa {
            curve: ssh_key::EcdsaCurve::NistP256,
        },
        _ => return Err(anyhow!("Unsupported algorithm: {}", args.algorithm)),
    };

    println!("🔑 Generating SSH key with prefix: {}", args.prefix);
    println!("📊 Algorithm: {}", algorithm);
    println!("🎯 Maximum attempts: {}", args.max_attempts);
    println!();

    let start_time = Instant::now();
    let mut attempts = 0;

    loop {
        attempts += 1;

        if attempts > args.max_attempts {
            return Err(anyhow!(
                "Failed to find matching key after {} attempts",
                args.max_attempts
            ));
        }

        if attempts % 1000 == 0 {
            let elapsed = start_time.elapsed().as_secs();
            let rate = if elapsed > 0 {
                attempts as u64 / elapsed
            } else {
                attempts as u64
            };
            print!("\r⏳ Attempts: {} | Rate: {} attempts/sec", attempts, rate);
            io::stdout().flush()?;
        }

        let key_pair = PrivateKey::random(&mut rand::thread_rng(), algorithm.clone())?;
        let public_key = key_pair.public_key();
        let public_key_str = public_key.to_openssh()?;

        if public_key_str.starts_with(&args.prefix) {
            println!("\n\n✅ Found matching key after {} attempts!", attempts);
            println!(
                "⏱️  Time elapsed: {:.2} seconds",
                start_time.elapsed().as_secs_f64()
            );
            println!();
            println!("🔐 Public key:");
            println!("{}", public_key_str);
            println!();

            let save_dir = match args.dir {
                Some(dir) => dir,
                None => {
                    let mut ssh_dir =
                        home_dir().ok_or_else(|| anyhow!("Cannot find home directory"))?;
                    ssh_dir.push(".ssh");
                    ssh_dir
                }
            };

            println!("💾 Save location: {}", save_dir.display());
            print!("🤔 Do you want to save this key? (y/N): ");
            io::stdout().flush()?;

            let mut input = String::new();
            io::stdin().read_line(&mut input)?;

            if input.trim().to_lowercase() == "y" || input.trim().to_lowercase() == "yes" {
                save_keys(&key_pair, &args.prefix, &save_dir)?;
                println!("🎉 Keys saved successfully!");
            } else {
                println!("❌ Key generation cancelled.");
            }

            break;
        }
    }

    Ok(())
}

fn save_keys(key_pair: &PrivateKey, prefix: &str, save_dir: &PathBuf) -> Result<()> {
    if !save_dir.exists() {
        fs::create_dir_all(save_dir)?;
    }

    let private_key_path = save_dir.join(format!("{}_{}", prefix, "id"));
    let public_key_path = save_dir.join(format!("{}_{}", prefix, "id.pub"));

    let private_key_pem = key_pair.to_openssh(LineEnding::LF)?;
    fs::write(&private_key_path, private_key_pem)?;

    let public_key_str = key_pair.public_key().to_openssh()?;
    fs::write(&public_key_path, public_key_str)?;

    println!("🔒 Private key: {}", private_key_path.display());
    println!("📋 Public key: {}", public_key_path.display());

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&private_key_path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}
