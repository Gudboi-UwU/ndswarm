package model

type Project struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   int64  `json:"createdAt"`
	TestCount   int    `json:"testCount"`
	TargetCount int    `json:"targetCount"`
	LastRunAt   *int64 `json:"lastRunAt"`
}

func (p *Project) Validate() error {
	var v ValidationError
	checkName(&v, "name", p.Name)
	v.Check(len(p.Description) <= 2000, "description", "Use at most 2000 characters.")
	return v.Err()
}
