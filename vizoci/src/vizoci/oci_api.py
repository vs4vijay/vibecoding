"""OCI API client using official OCI Python SDK."""
import datetime
import os

import oci
from oci.core import ComputeClient
from oci.identity import IdentityClient

from vizoci.config import OCIConfig


class OCIApi:
    def __init__(self, config: OCIConfig, auto_discover: bool = True):
        self.config = config
        self._config = self._build_config(auto_discover)
        self._compute_client = ComputeClient(self._config)
        self._identity_client = IdentityClient(self._config)

    def _build_config(self, auto_discover: bool):
        """Build OCI config, optionally auto-discover from config file."""
        oci_config_file = os.getenv("OCI_CONFIG_FILE")

        # Load from OCI config file (~/.oci/config)
        oci_config = {}
        try:
            if oci_config_file:
                oci_config = oci.config.from_file(file_location=oci_config_file)
            else:
                oci_config = oci.config.from_file()
        except Exception:
            pass

        # Use provided values, fall back to discovered from config file
        config_dict = {
            "tenancy": self.config.tenancy_id or oci_config.get("tenancy"),
            "user": self.config.user_id or oci_config.get("user"),
            "fingerprint": self.config.key_fingerprint or oci_config.get("fingerprint"),
            "key_file": self.config.private_key_filename or oci_config.get("key_file"),
            "region": self.config.region or oci_config.get("region"),
        }

        return config_dict

    def get_config(self):
        """Return the OCI config dict (for debugging/discovery)."""
        return {
            "tenancy": self._config["tenancy"],
            "user": self._config["user"],
            "fingerprint": self._config["fingerprint"],
            "region": self._config["region"],
        }

    def get_compartment(self):
        """Get the root compartment (tenancy) info."""
        return self._identity_client.get_compartment(self._config["tenancy"]).data

    def get_default_subnet(self):
        """Get the first available subnet in the default compartment."""
        subnets = self.list_subnets()
        return subnets[0] if subnets else None

    def list_subnets(self) -> list:
        """List all available subnets in the compartment."""
        from oci.core import VirtualNetworkClient

        vnc_client = VirtualNetworkClient(self._config)

        response = vnc_client.list_vcns(compartment_id=self._config["tenancy"])
        if not response.data:
            return []

        vcn = response.data[0]

        subnets = vnc_client.list_subnets(
            compartment_id=self._config["tenancy"],
            vcn_id=vcn.id
        )

        return subnets.data

    def get_default_image(self):
        """Get the default Ubuntu image for the region."""
        images = self.list_images()
        for img in images:
            if "Ubuntu" in img.display_name:
                if "22.04" in img.display_name or "24.04" in img.display_name:
                    return img
        for img in images:
            if "Ubuntu" in img.display_name:
                return img
        return images[0] if images else None

    def list_images(self) -> list:
        """List all available images in the compartment."""
        response = self._compute_client.list_images(
            compartment_id=self._config["tenancy"],
            sort_by="TIMECREATED",
            sort_order="DESC"
        )
        return response.data

    def get_instances(self) -> list:
        """Get all instances in the compartment."""
        response = self._compute_client.list_instances(
            compartment_id=self._config["tenancy"]
        )
        return response.data

    def get_availability_domains(self) -> list:
        """Get availability domains for the tenancy."""
        response = self._identity_client.list_availability_domains(
            compartment_id=self._config["tenancy"]
        )
        return response.data

    def get_instance(self, instance_id: str):
        """Get a specific instance by ID."""
        response = self._compute_client.get_instance(instance_id=instance_id)
        return response.data

    def get_shapes(self) -> list:
        """Get available shapes in the region."""
        response = self._compute_client.list_shapes(
            compartment_id=self._config["tenancy"]
        )
        return response.data

    def get_instance_vnics(self, instance_id: str) -> list:
        """Get VNICs attached to an instance."""
        response = self._compute_client.list_vnic_attachments(
            compartment_id=self._config["tenancy"],
            instance_id=instance_id
        )
        return response.data

    def get_vnic(self, vnic_id: str):
        """Get VNIC details."""
        from oci.core import VirtualNetworkClient

        vnc_client = VirtualNetworkClient(self._config)
        response = vnc_client.get_vnic(vnic_id=vnic_id)
        return response.data

    def create_instance(self, availability_domain: str) -> dict:
        """Create a new instance."""
        display_name = f"instance-{datetime.datetime.now().strftime('%Y%m%d-%H%M')}"

        ssh_key = self.config.ssh_public_key.replace("\n", " ").replace("\\", "").strip()

        create_vnic_details = oci.core.models.CreateVnicDetails(
            subnet_id=self.config.subnet_id,
            assign_public_ip=self.config.assign_public_ip,
            assign_private_dns_record=True,
        )

        agent_config = oci.core.models.LaunchInstanceAgentConfigDetails(
            is_monitoring_disabled=False,
            is_management_disabled=False,
            plugins_config=[
                oci.core.models.InstanceAgentPluginConfigDetails(
                    name="Compute Instance Monitoring", desired_state="ENABLED"
                )
            ],
        )

        shape_config = oci.core.models.LaunchInstanceShapeConfigDetails(
            ocpus=self.config.ocpus,
            memory_in_gbs=self.config.memory_in_gbs,
        )

        instance_options = oci.core.models.InstanceOptions(
            are_legacy_imds_endpoints_disabled=False,
        )

        availability_config = oci.core.models.LaunchInstanceAvailabilityConfigDetails(
            recovery_action="RESTORE_INSTANCE",
        )

        source_details = oci.core.models.InstanceSourceViaImageDetails(
            source_type="image"
        )
        source_details.image_id = self.config.image_id

        if self.config.boot_volume_size_in_gbs:
            source_details.boot_volume_size_in_gbs = self.config.boot_volume_size_in_gbs

        launch_instance_details = oci.core.models.LaunchInstanceDetails(
            display_name=display_name,
            compartment_id=self._config["tenancy"],
            availability_domain=availability_domain,
            shape=self.config.shape,
            source_details=source_details,
            create_vnic_details=create_vnic_details,
            metadata={"ssh_authorized_keys": ssh_key},
            agent_config=agent_config,
            instance_options=instance_options,
            availability_config=availability_config,
            shape_config=shape_config,
            defined_tags={},
            freeform_tags={},
        )

        response = self._compute_client.launch_instance(launch_instance_details)
        return response.data

    def check_existing_instances(
        self, instances: list, shape: str, max_count: int
    ) -> str | None:
        """Check if we already have enough instances of the given shape."""
        acceptable_states = ["TERMINATED"]
        running = [
            inst
            for inst in instances
            if inst.shape == shape
            and inst.lifecycle_state not in acceptable_states
        ]

        if len(running) >= max_count:
            names = ", ".join(i.display_name for i in running)
            states = ", ".join(i.lifecycle_state for i in running)
            return f"Already have instance(s) [{names}] in state(s) [{states}]"

        return None