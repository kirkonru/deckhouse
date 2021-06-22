package commands

import (
	"fmt"

	"gopkg.in/alecthomas/kingpin.v2"

	"github.com/deckhouse/deckhouse/dhctl/pkg/app"
	"github.com/deckhouse/deckhouse/dhctl/pkg/config"
	"github.com/deckhouse/deckhouse/dhctl/pkg/kubernetes/actions/converge"
	"github.com/deckhouse/deckhouse/dhctl/pkg/kubernetes/actions/deckhouse"
	"github.com/deckhouse/deckhouse/dhctl/pkg/kubernetes/client"
	"github.com/deckhouse/deckhouse/dhctl/pkg/log"
	"github.com/deckhouse/deckhouse/dhctl/pkg/operations"
	"github.com/deckhouse/deckhouse/dhctl/pkg/system/ssh"
	"github.com/deckhouse/deckhouse/dhctl/pkg/terraform"
)

func DefineConvergeCommand(kpApp *kingpin.Application) *kingpin.CmdClause {
	cmd := kpApp.Command("converge", "Converge kubernetes cluster.")
	app.DefineSSHFlags(cmd)
	app.DefineBecomeFlags(cmd)
	app.DefineKubeFlags(cmd)

	runFunc := func(sshClient *ssh.Client) error {
		kubeCl, err := operations.ConnectToKubernetesAPI(sshClient)
		if err != nil {
			return err
		}

		if info := deckhouse.GetClusterInfo(kubeCl); info != "" {
			_ = log.Process("common", "Cluster Info", func() error { log.InfoF(info); return nil })
		}

		convIdentity := config.GetLocalConvergeLockIdentity("local-converger")
		runner := converge.NewRunner(kubeCl, config.GetConvergeLockLeaseConfig(convIdentity))
		runner.WithChangeSettings(&terraform.ChangeActionSettings{
			AutoDismissDestructive: false,
		})

		err = runner.RunConverge()
		if err != nil {
			return fmt.Errorf("converge problem: %v", err)
		}

		return nil
	}

	cmd.Action(func(c *kingpin.ParseContext) error {
		sshClient, err := ssh.NewInitClientFromFlags(true)
		if err != nil {
			return err
		}

		return runFunc(sshClient)
	})
	return cmd
}

func DefineAutoConvergeCommand(kpApp *kingpin.Application) *kingpin.CmdClause {
	cmd := kpApp.Command("converge-periodical", "Start service for periodical run converge.")
	app.DefineAutoConvergeFlags(cmd)
	app.DefineSSHFlags(cmd)
	app.DefineBecomeFlags(cmd)
	app.DefineKubeFlags(cmd)

	cmd.Action(func(c *kingpin.ParseContext) error {
		if app.RunningNodeName == "" {
			return fmt.Errorf("Need to pass running node name. It is may taints terraform state while converge")
		}

		sshClient, err := ssh.NewInitClientFromFlags(false)
		if err != nil {
			return err
		}

		kubeCl := client.NewKubernetesClient().WithSSHClient(sshClient)
		if err := kubeCl.Init(client.AppKubernetesInitParams()); err != nil {
			return err
		}

		runner := converge.NewRunner(kubeCl, config.GetConvergeLockLeaseConfig("terraform-auto-converger")).
			WithChangeSettings(&terraform.ChangeActionSettings{
				AutoDismissDestructive: true,
				AutoApprove:            true,
			}).
			WithExcludedNodes([]string{app.RunningNodeName}).
			WithSkipPhases([]converge.Phase{converge.PhaseAllNodes})

		converger := operations.NewAutoConverger(runner, app.AutoConvergeListenAddress, app.ApplyInterval)
		return converger.Start()
	})
	return cmd
}
